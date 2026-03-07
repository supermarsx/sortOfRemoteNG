// ── Grafana alert management ─────────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct AlertManager;

impl AlertManager {
    // ── Alert rules ──────────────────────────────────────────────────

    pub async fn list_alert_rules(client: &GrafanaClient) -> GrafanaResult<Vec<AlertRule>> {
        let body = client.api_get("/api/v1/provisioning/alert-rules").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_alert_rules: {e}")))
    }

    pub async fn get_alert_rule(client: &GrafanaClient, uid: &str) -> GrafanaResult<AlertRule> {
        let body = client.api_get(&format!("/api/v1/provisioning/alert-rules/{uid}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_alert_rule: {e}")))
    }

    pub async fn create_alert_rule(client: &GrafanaClient, req: &CreateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/v1/provisioning/alert-rules", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_alert_rule: {e}")))
    }

    pub async fn update_alert_rule(client: &GrafanaClient, uid: &str, req: &UpdateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_put(&format!("/api/v1/provisioning/alert-rules/{uid}"), &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("update_alert_rule: {e}")))
    }

    pub async fn delete_alert_rule(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/v1/provisioning/alert-rules/{uid}")).await?;
        Ok(())
    }

    pub async fn list_alert_instances(client: &GrafanaClient) -> GrafanaResult<Vec<AlertInstance>> {
        let body = client.api_get("/api/alertmanager/grafana/api/v2/alerts").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_alert_instances: {e}")))
    }

    pub async fn get_alert_rule_groups(client: &GrafanaClient, folder_uid: &str) -> GrafanaResult<Vec<AlertRuleGroup>> {
        let body = client.api_get(&format!("/api/v1/provisioning/folder/{folder_uid}/rule-groups")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_alert_rule_groups: {e}")))
    }

    // ── Contact points ───────────────────────────────────────────────

    pub async fn list_contact_points(client: &GrafanaClient) -> GrafanaResult<Vec<ContactPoint>> {
        let body = client.api_get("/api/v1/provisioning/contact-points").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_contact_points: {e}")))
    }

    pub async fn create_contact_point(client: &GrafanaClient, req: &CreateContactPointRequest) -> GrafanaResult<ContactPoint> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/v1/provisioning/contact-points", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_contact_point: {e}")))
    }

    pub async fn update_contact_point(client: &GrafanaClient, uid: &str, req: &UpdateContactPointRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put(&format!("/api/v1/provisioning/contact-points/{uid}"), &payload).await?;
        Ok(())
    }

    pub async fn delete_contact_point(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/v1/provisioning/contact-points/{uid}")).await?;
        Ok(())
    }

    // ── Notification policies ────────────────────────────────────────

    pub async fn list_notification_policies(client: &GrafanaClient) -> GrafanaResult<NotificationPolicy> {
        let body = client.api_get("/api/v1/provisioning/policies").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_notification_policies: {e}")))
    }

    pub async fn update_notification_policy(client: &GrafanaClient, policy: &NotificationPolicy) -> GrafanaResult<()> {
        let payload = serde_json::to_string(policy).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put("/api/v1/provisioning/policies", &payload).await?;
        Ok(())
    }

    // ── Silences ─────────────────────────────────────────────────────

    pub async fn list_silences(client: &GrafanaClient) -> GrafanaResult<Vec<AlertSilence>> {
        let body = client.api_get("/api/alertmanager/grafana/api/v2/silences").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_silences: {e}")))
    }

    pub async fn create_silence(client: &GrafanaClient, req: &CreateSilenceRequest) -> GrafanaResult<AlertSilence> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/alertmanager/grafana/api/v2/silences", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_silence: {e}")))
    }

    pub async fn delete_silence(client: &GrafanaClient, id: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/alertmanager/grafana/api/v2/silence/{id}")).await?;
        Ok(())
    }

    // ── Mute timings ─────────────────────────────────────────────────

    pub async fn list_mute_timings(client: &GrafanaClient) -> GrafanaResult<Vec<MuteTiming>> {
        let body = client.api_get("/api/v1/provisioning/mute-timings").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_mute_timings: {e}")))
    }

    pub async fn create_mute_timing(client: &GrafanaClient, req: &CreateMuteTimingRequest) -> GrafanaResult<MuteTiming> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/v1/provisioning/mute-timings", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_mute_timing: {e}")))
    }

    pub async fn update_mute_timing(client: &GrafanaClient, name: &str, req: &UpdateMuteTimingRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_put(&format!("/api/v1/provisioning/mute-timings/{name}"), &payload).await?;
        Ok(())
    }

    pub async fn delete_mute_timing(client: &GrafanaClient, name: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/v1/provisioning/mute-timings/{name}")).await?;
        Ok(())
    }

    // ── Misc ─────────────────────────────────────────────────────────

    pub async fn test_contact_point(client: &GrafanaClient, req: &CreateContactPointRequest) -> GrafanaResult<()> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        client.api_post("/api/v1/provisioning/contact-points/test", &payload).await?;
        Ok(())
    }

    pub async fn get_alert_state_history(client: &GrafanaClient, rule_uid: &str) -> GrafanaResult<AlertStateHistory> {
        let body = client.api_get(&format!("/api/v1/rules/history?ruleUID={rule_uid}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_alert_state_history: {e}")))
    }
}
