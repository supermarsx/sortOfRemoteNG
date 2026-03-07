// ── sorng-grafana/src/orgs.rs ────────────────────────────────────────────────
//! Organization management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct OrgManager;

impl OrgManager {
    /// List all organizations.  GET /api/orgs
    pub async fn list(client: &GrafanaClient) -> GrafanaResult<Vec<Organization>> {
        client.api_get("orgs").await
    }

    /// Get organization by ID.  GET /api/orgs/:id
    pub async fn get(client: &GrafanaClient, id: u64) -> GrafanaResult<Organization> {
        client.api_get(&format!("orgs/{id}")).await
    }

    /// Get organization by name.  GET /api/orgs/name/:name
    pub async fn get_by_name(
        client: &GrafanaClient,
        name: &str,
    ) -> GrafanaResult<Organization> {
        client.api_get(&format!("orgs/name/{name}")).await
    }

    /// Create an organization.  POST /api/orgs
    pub async fn create(
        client: &GrafanaClient,
        name: &str,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "name": name });
        client.api_post("orgs", &body).await
    }

    /// Update an organization.  PUT /api/orgs/:id
    pub async fn update(
        client: &GrafanaClient,
        id: u64,
        name: &str,
        address: Option<&OrgAddress>,
    ) -> GrafanaResult<serde_json::Value> {
        let mut body = serde_json::json!({ "name": name });
        if let Some(addr) = address {
            body["address"] = serde_json::to_value(addr)
                .unwrap_or_default();
        }
        client.api_put(&format!("orgs/{id}"), &body).await
    }

    /// Delete an organization.  DELETE /api/orgs/:id
    pub async fn delete(
        client: &GrafanaClient,
        id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("orgs/{id}")).await
    }

    /// Get current organization.  GET /api/org
    pub async fn get_current(
        client: &GrafanaClient,
    ) -> GrafanaResult<Organization> {
        client.api_get("org").await
    }

    /// Switch user context to another organization.  POST /api/user/using/:orgId
    pub async fn switch_org(
        client: &GrafanaClient,
        org_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({});
        client
            .api_post(&format!("user/using/{org_id}"), &body)
            .await
    }

    /// List users in an organization.  GET /api/orgs/:orgId/users
    pub async fn list_users(
        client: &GrafanaClient,
        org_id: u64,
    ) -> GrafanaResult<Vec<serde_json::Value>> {
        client.api_get(&format!("orgs/{org_id}/users")).await
    }

    /// Add a user to an organization.  POST /api/orgs/:orgId/users
    pub async fn add_user(
        client: &GrafanaClient,
        org_id: u64,
        login_or_email: &str,
        role: &str,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({
            "loginOrEmail": login_or_email,
            "role": role,
        });
        client
            .api_post(&format!("orgs/{org_id}/users"), &body)
            .await
    }

    /// Update user role in an organization.  PATCH /api/orgs/:orgId/users/:userId
    pub async fn update_user_role(
        client: &GrafanaClient,
        org_id: u64,
        user_id: u64,
        role: &str,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "role": role });
        client
            .api_patch(&format!("orgs/{org_id}/users/{user_id}"), &body)
            .await
    }

    /// Remove user from an organization.  DELETE /api/orgs/:orgId/users/:userId
    pub async fn remove_user(
        client: &GrafanaClient,
        org_id: u64,
        user_id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_delete(&format!("orgs/{org_id}/users/{user_id}"))
            .await
    }
}
