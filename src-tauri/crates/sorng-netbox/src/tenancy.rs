// ── sorng-netbox – Tenancy module ────────────────────────────────────────────
//! Tenants, tenant groups, contact assignments.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct TenancyManager;

impl TenancyManager {
    // ── Tenants ──────────────────────────────────────────────────────

    pub async fn list_tenants(client: &NetboxClient) -> NetboxResult<Vec<Tenant>> {
        client.api_get_list("/tenancy/tenants/").await
    }

    pub async fn get_tenant(client: &NetboxClient, id: i64) -> NetboxResult<Tenant> {
        let body = client.api_get(&format!("/tenancy/tenants/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_tenant: {e}")))
    }

    pub async fn create_tenant(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Tenant> {
        let body = client.api_post("/tenancy/tenants/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_tenant: {e}")))
    }

    pub async fn update_tenant(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Tenant> {
        let body = client.api_patch(&format!("/tenancy/tenants/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_tenant: {e}")))
    }

    pub async fn delete_tenant(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/tenancy/tenants/{id}/")).await?;
        Ok(())
    }

    // ── Tenant groups ────────────────────────────────────────────────

    pub async fn list_tenant_groups(client: &NetboxClient) -> NetboxResult<Vec<TenantGroup>> {
        client.api_get_list("/tenancy/tenant-groups/").await
    }

    // ── Contact assignments ──────────────────────────────────────────

    pub async fn list_contact_assignments(client: &NetboxClient) -> NetboxResult<Vec<ContactAssignment>> {
        client.api_get_list("/tenancy/contact-assignments/").await
    }
}
