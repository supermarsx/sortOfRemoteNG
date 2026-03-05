// ── NPM settings & audit ─────────────────────────────────────────────────────

use crate::client::NpmClient;
use crate::error::NpmResult;
use crate::types::*;

pub struct SettingsManager;

impl SettingsManager {
    pub async fn list(client: &NpmClient) -> NpmResult<Vec<NpmSetting>> {
        client.get("/settings").await
    }

    pub async fn get(client: &NpmClient, id: &str) -> NpmResult<NpmSetting> {
        client.get(&format!("/settings/{}", id)).await
    }

    pub async fn update(client: &NpmClient, id: &str, value: &serde_json::Value) -> NpmResult<NpmSetting> {
        client.put(&format!("/settings/{}", id), &serde_json::json!({ "value": value })).await
    }

    pub async fn get_reports(client: &NpmClient) -> NpmResult<NpmReports> {
        client.get("/reports/hosts").await
    }

    pub async fn get_audit_log(client: &NpmClient) -> NpmResult<Vec<NpmAuditLogEntry>> {
        client.get("/audit-log?expand=user").await
    }

    pub async fn get_health(client: &NpmClient) -> NpmResult<NpmHealthStatus> {
        client.get("/").await
    }
}
