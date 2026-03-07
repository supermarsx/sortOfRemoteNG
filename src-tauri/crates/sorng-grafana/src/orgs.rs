// ── Grafana organization management ──────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct OrgManager;

impl OrgManager {
    pub async fn list_orgs(client: &GrafanaClient) -> GrafanaResult<Vec<GrafanaOrg>> {
        let body = client.api_get("/api/orgs").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_orgs: {e}")))
    }

    pub async fn get_org(client: &GrafanaClient, id: i64) -> GrafanaResult<GrafanaOrg> {
        let body = client.api_get(&format!("/api/orgs/{id}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_org: {e}")))
    }

    pub async fn get_org_by_name(client: &GrafanaClient, name: &str) -> GrafanaResult<GrafanaOrg> {
        let body = client.api_get(&format!("/api/orgs/name/{name}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_org_by_name: {e}")))
    }

    pub async fn create_org(client: &GrafanaClient, req: &CreateOrgRequest) -> GrafanaResult<GrafanaOrg> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/orgs", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_org: {e}")))
    }

    pub async fn update_org(client: &GrafanaClient, id: i64, req: &UpdateOrgRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put(&format!("/api/orgs/{id}"), &payload).await?;
        Ok(())
    }

    pub async fn delete_org(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/orgs/{id}")).await?;
        Ok(())
    }

    pub async fn list_org_users(client: &GrafanaClient, org_id: i64) -> GrafanaResult<Vec<OrgUser>> {
        let body = client.api_get(&format!("/api/orgs/{org_id}/users")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_org_users: {e}")))
    }

    pub async fn add_user_to_org_role(client: &GrafanaClient, org_id: i64, req: &AddOrgUserRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/orgs/{org_id}/users"), &payload).await?;
        Ok(())
    }

    pub async fn update_org_user_role(client: &GrafanaClient, org_id: i64, user_id: i64, req: &UpdateOrgUserRoleRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_patch(&format!("/api/orgs/{org_id}/users/{user_id}"), &payload).await?;
        Ok(())
    }

    pub async fn remove_user_from_org_mgmt(client: &GrafanaClient, org_id: i64, user_id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/orgs/{org_id}/users/{user_id}")).await?;
        Ok(())
    }

    pub async fn get_current_org(client: &GrafanaClient) -> GrafanaResult<GrafanaOrg> {
        let body = client.api_get("/api/org").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_current_org: {e}")))
    }

    pub async fn update_current_org(client: &GrafanaClient, req: &UpdateOrgRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put("/api/org", &payload).await?;
        Ok(())
    }

    pub async fn get_org_preferences(client: &GrafanaClient) -> GrafanaResult<OrgPreferences> {
        let body = client.api_get("/api/org/preferences").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_org_preferences: {e}")))
    }

    pub async fn update_org_preferences(client: &GrafanaClient, prefs: &OrgPreferences) -> GrafanaResult<()> {
        let payload = serde_json::to_string(prefs).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put("/api/org/preferences", &payload).await?;
        Ok(())
    }
}
