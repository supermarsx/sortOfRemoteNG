// ── Grafana user management ──────────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct UserManager;

impl UserManager {
    pub async fn list_users(client: &GrafanaClient) -> GrafanaResult<Vec<GrafanaUser>> {
        let body = client.api_get("/api/users").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_users: {e}")))
    }

    pub async fn get_user(client: &GrafanaClient, id: i64) -> GrafanaResult<GrafanaUser> {
        let body = client.api_get(&format!("/api/users/{id}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_user: {e}")))
    }

    pub async fn get_user_by_login(client: &GrafanaClient, login: &str) -> GrafanaResult<GrafanaUser> {
        let body = client.api_get(&format!("/api/users/lookup?loginOrEmail={login}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_user_by_login: {e}")))
    }

    pub async fn create_user(client: &GrafanaClient, req: &CreateUserRequest) -> GrafanaResult<GrafanaUser> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/admin/users", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_user: {e}")))
    }

    pub async fn update_user(client: &GrafanaClient, id: i64, req: &UpdateUserRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put(&format!("/api/users/{id}"), &payload).await?;
        Ok(())
    }

    pub async fn delete_user(client: &GrafanaClient, id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/admin/users/{id}")).await?;
        Ok(())
    }

    pub async fn get_user_orgs(client: &GrafanaClient, id: i64) -> GrafanaResult<Vec<UserOrg>> {
        let body = client.api_get(&format!("/api/users/{id}/orgs")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_user_orgs: {e}")))
    }

    pub async fn add_user_to_org(client: &GrafanaClient, org_id: i64, req: &AddUserToOrgRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post(&format!("/api/orgs/{org_id}/users"), &payload).await?;
        Ok(())
    }

    pub async fn remove_user_from_org(client: &GrafanaClient, org_id: i64, user_id: i64) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/orgs/{org_id}/users/{user_id}")).await?;
        Ok(())
    }

    pub async fn update_user_role(client: &GrafanaClient, org_id: i64, user_id: i64, req: &UpdateUserRoleRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_patch(&format!("/api/orgs/{org_id}/users/{user_id}"), &payload).await?;
        Ok(())
    }

    pub async fn get_user_preferences(client: &GrafanaClient) -> GrafanaResult<UserPreferences> {
        let body = client.api_get("/api/user/preferences").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_user_preferences: {e}")))
    }

    pub async fn update_user_preferences(client: &GrafanaClient, prefs: &UserPreferences) -> GrafanaResult<()> {
        let payload = serde_json::to_string(prefs).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put("/api/user/preferences", &payload).await?;
        Ok(())
    }

    pub async fn change_user_password(client: &GrafanaClient, req: &ChangePasswordRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put("/api/user/password", &payload).await?;
        Ok(())
    }

    pub async fn get_current_user(client: &GrafanaClient) -> GrafanaResult<GrafanaUser> {
        let body = client.api_get("/api/user").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_current_user: {e}")))
    }

    pub async fn update_current_user(client: &GrafanaClient, req: &UpdateUserRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put("/api/user", &payload).await?;
        Ok(())
    }

    pub async fn star_dashboard_for_user(client: &GrafanaClient, dashboard_id: i64) -> GrafanaResult<()> {
        client.api_post(&format!("/api/user/stars/dashboard/{dashboard_id}"), "").await?;
        Ok(())
    }
}
