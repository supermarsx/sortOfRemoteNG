//! Organization management for Grafana.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct OrgManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> OrgManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List all organizations.
    pub async fn list(&self) -> GrafanaResult<Vec<GrafanaOrg>> {
        self.client.api_get("/orgs").await
    }

    /// Get an organization by ID.
    pub async fn get(&self, org_id: i64) -> GrafanaResult<GrafanaOrg> {
        self.client
            .api_get(&format!("/orgs/{}", org_id))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::org_not_found(format!("Org {} not found", org_id))
                }
                _ => e,
            })
    }

    /// Create a new organization.
    pub async fn create(&self, req: CreateOrgRequest) -> GrafanaResult<serde_json::Value> {
        self.client.api_post("/orgs", &req).await
    }

    /// Update an organization.
    pub async fn update(&self, org_id: i64, req: UpdateOrgRequest) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put(&format!("/orgs/{}", org_id), &req)
            .await
    }

    /// Delete an organization.
    pub async fn delete(&self, org_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/orgs/{}", org_id))
            .await
    }

    /// List users in an organization.
    pub async fn list_users(&self, org_id: i64) -> GrafanaResult<Vec<OrgUser>> {
        self.client
            .api_get(&format!("/orgs/{}/users", org_id))
            .await
    }

    /// Add a user to an organization.
    pub async fn add_user(
        &self,
        org_id: i64,
        login_or_email: &str,
        role: OrgRole,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({
            "loginOrEmail": login_or_email,
            "role": role.to_string()
        });
        self.client
            .api_post(&format!("/orgs/{}/users", org_id), &body)
            .await
    }

    /// Update a user's role in an organization.
    pub async fn update_user_role(
        &self,
        org_id: i64,
        user_id: i64,
        role: OrgRole,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "role": role.to_string() });
        self.client
            .api_patch(&format!("/orgs/{}/users/{}", org_id, user_id), &body)
            .await
    }

    /// Remove a user from an organization.
    pub async fn remove_user(&self, org_id: i64, user_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/orgs/{}/users/{}", org_id, user_id))
            .await
    }

    /// Get the current organization.
    pub async fn get_current(&self) -> GrafanaResult<GrafanaOrg> {
        self.client.api_get("/org").await
    }

    /// Switch the current user's active organization.
    pub async fn switch_current(&self, org_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(&format!("/user/using/{}", org_id), &serde_json::json!({}))
            .await
    }
}
