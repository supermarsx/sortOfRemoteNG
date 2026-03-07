// ── Grafana admin / system management ────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct AdminManager;

impl AdminManager {
    pub async fn get_settings(client: &GrafanaClient) -> GrafanaResult<GrafanaSettings> {
        let body = client.api_get("/api/admin/settings").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_settings: {e}")))
    }

    pub async fn get_stats(client: &GrafanaClient) -> GrafanaResult<GrafanaStats> {
        let body = client.api_get("/api/admin/stats").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_stats: {e}")))
    }

    pub async fn get_health(client: &GrafanaClient) -> GrafanaResult<GrafanaHealth> {
        let body = client.api_get("/api/health").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_health: {e}")))
    }

    pub async fn get_version(client: &GrafanaClient) -> GrafanaResult<GrafanaVersion> {
        let body = client.api_get("/api/health").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_version: {e}")))
    }

    pub async fn get_frontend_settings(client: &GrafanaClient) -> GrafanaResult<serde_json::Value> {
        let body = client.api_get("/api/frontend/settings").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_frontend_settings: {e}")))
    }

    pub async fn list_provisioned_dashboards(client: &GrafanaClient) -> GrafanaResult<Vec<serde_json::Value>> {
        let body = client.api_get("/api/admin/provisioning/dashboards").await
            .unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_provisioned_dashboards: {e}")))
    }

    pub async fn list_provisioned_datasources(client: &GrafanaClient) -> GrafanaResult<Vec<serde_json::Value>> {
        let body = client.api_get("/api/admin/provisioning/datasources").await
            .unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_provisioned_datasources: {e}")))
    }

    pub async fn list_provisioned_alert_rules(client: &GrafanaClient) -> GrafanaResult<Vec<serde_json::Value>> {
        let body = client.api_get("/api/admin/provisioning/alert-rules").await
            .unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_provisioned_alert_rules: {e}")))
    }

    pub async fn reload_provisioning(client: &GrafanaClient, provisioner: &str) -> GrafanaResult<()> {
        client.api_post(&format!("/api/admin/provisioning/{provisioner}/reload"), "").await?;
        Ok(())
    }

    pub async fn get_usage_stats(client: &GrafanaClient) -> GrafanaResult<UsageStats> {
        let body = client.api_get("/api/admin/usage-report-preview").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_usage_stats: {e}")))
    }
}
