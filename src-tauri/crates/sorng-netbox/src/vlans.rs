// ── sorng-netbox/src/vlans.rs ────────────────────────────────────────────────
//! VLAN management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct VlanManager;

impl VlanManager {
    // ── VLANs ────────────────────────────────────────────────────────

    pub async fn list(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Vlan>> {
        client.api_get_paginated("ipam/vlans", params).await
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Vlan> {
        client.api_get(&format!("ipam/vlans/{id}")).await
    }

    pub async fn create(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Vlan> {
        client.api_post("ipam/vlans", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Vlan> {
        client.api_put(&format!("ipam/vlans/{id}"), data).await
    }

    pub async fn partial_update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Vlan> {
        client.api_patch(&format!("ipam/vlans/{id}"), data).await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("ipam/vlans/{id}")).await
    }

    pub async fn list_by_site(
        client: &NetboxClient,
        site_id: i64,
    ) -> NetboxResult<PaginatedResponse<Vlan>> {
        let sid = site_id.to_string();
        client
            .api_get_paginated("ipam/vlans", &[("site_id", &sid)])
            .await
    }

    pub async fn list_by_group(
        client: &NetboxClient,
        group_id: i64,
    ) -> NetboxResult<PaginatedResponse<Vlan>> {
        let gid = group_id.to_string();
        client
            .api_get_paginated("ipam/vlans", &[("group_id", &gid)])
            .await
    }

    // ── VLAN Groups ──────────────────────────────────────────────────

    pub async fn list_groups(client: &NetboxClient) -> NetboxResult<PaginatedResponse<VlanGroup>> {
        client.api_get_paginated("ipam/vlan-groups", &[]).await
    }

    pub async fn get_group(client: &NetboxClient, id: i64) -> NetboxResult<VlanGroup> {
        client.api_get(&format!("ipam/vlan-groups/{id}")).await
    }

    pub async fn create_group(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<VlanGroup> {
        client.api_post("ipam/vlan-groups", data).await
    }

    pub async fn update_group(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<VlanGroup> {
        client
            .api_put(&format!("ipam/vlan-groups/{id}"), data)
            .await
    }

    pub async fn delete_group(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("ipam/vlan-groups/{id}")).await
    }
}
