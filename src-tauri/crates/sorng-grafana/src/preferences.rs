//! Preferences management for Grafana.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct PreferencesManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> PreferencesManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// Get the current user's preferences.
    pub async fn get_user_prefs(&self) -> GrafanaResult<UserPreferences> {
        self.client.api_get("/user/preferences").await
    }

    /// Update the current user's preferences.
    pub async fn update_user_prefs(&self, prefs: UserPreferences) -> GrafanaResult<serde_json::Value> {
        self.client.api_put("/user/preferences", &prefs).await
    }

    /// Get the current organization's preferences.
    pub async fn get_org_prefs(&self) -> GrafanaResult<OrgPreferences> {
        self.client.api_get("/org/preferences").await
    }

    /// Update the current organization's preferences.
    pub async fn update_org_prefs(&self, prefs: OrgPreferences) -> GrafanaResult<serde_json::Value> {
        self.client.api_put("/org/preferences", &prefs).await
    }

    /// Star a dashboard for the current user.
    pub async fn star_dashboard(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post(
                &format!("/user/stars/dashboard/{}", dashboard_id),
                &serde_json::json!({}),
            )
            .await
    }

    /// Unstar a dashboard for the current user.
    pub async fn unstar_dashboard(&self, dashboard_id: i64) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/user/stars/dashboard/{}", dashboard_id))
            .await
    }

    /// List all starred dashboards for the current user.
    pub async fn list_starred(&self) -> GrafanaResult<Vec<GrafanaDashboard>> {
        let params = [("starred", "true")];
        self.client.api_get_with_query("/search", &params).await
    }
}
