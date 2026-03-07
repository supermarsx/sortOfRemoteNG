// ── sorng-netbox/src/tenants.rs ──────────────────────────────────────────────
//! Tenant management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct TenantManager;

impl TenantManager {
    // ── Tenants ──────────────────────────────────────────────────────

    pub async fn list(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Tenant>> {
        client.api_get_paginated("tenancy/tenants", params).await
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Tenant> {
        client.api_get(&format!("tenancy/tenants/{id}")).await
    }

    pub async fn create(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Tenant> {
        client.api_post("tenancy/tenants", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Tenant> {
        client.api_put(&format!("tenancy/tenants/{id}"), data).await
    }

    pub async fn partial_update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Tenant> {
        client.api_patch(&format!("tenancy/tenants/{id}"), data).await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("tenancy/tenants/{id}")).await
    }

    // ── Tenant Groups ────────────────────────────────────────────────

    pub async fn list_groups(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<TenantGroup>> {
        client.api_get_paginated("tenancy/tenant-groups", &[]).await
    }

    pub async fn get_group(client: &NetboxClient, id: i64) -> NetboxResult<TenantGroup> {
        client.api_get(&format!("tenancy/tenant-groups/{id}")).await
    }

    pub async fn create_group(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<TenantGroup> {
        client.api_post("tenancy/tenant-groups", data).await
    }

    pub async fn update_group(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<TenantGroup> {
        client.api_put(&format!("tenancy/tenant-groups/{id}"), data).await
    }

    pub async fn delete_group(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("tenancy/tenant-groups/{id}")).await
    }
}
