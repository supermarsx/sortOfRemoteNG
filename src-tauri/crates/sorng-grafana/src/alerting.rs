//! Alerting management for Grafana unified alerting.

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct AlertManager<'a> {
    client: &'a GrafanaClient,
}

impl<'a> AlertManager<'a> {
    pub fn new(client: &'a GrafanaClient) -> Self {
        Self { client }
    }

    /// List all alert rules.
    pub async fn list_rules(&self) -> GrafanaResult<Vec<AlertRule>> {
        self.client
            .api_get("/v1/provisioning/alert-rules")
            .await
    }

    /// Get an alert rule by UID.
    pub async fn get_rule(&self, uid: &str) -> GrafanaResult<AlertRule> {
        self.client
            .api_get(&format!("/v1/provisioning/alert-rules/{}", uid))
            .await
            .map_err(|e| match e.kind {
                crate::error::GrafanaErrorKind::ApiError if e.message.contains("404") => {
                    GrafanaError::alert_not_found(format!("Alert rule '{}' not found", uid))
                }
                _ => e,
            })
    }

    /// Create a new alert rule.
    pub async fn create_rule(&self, req: CreateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        self.client
            .api_post("/v1/provisioning/alert-rules", &req)
            .await
    }

    /// Update an existing alert rule.
    pub async fn update_rule(&self, uid: &str, req: CreateAlertRuleRequest) -> GrafanaResult<AlertRule> {
        self.client
            .api_put(&format!("/v1/provisioning/alert-rules/{}", uid), &req)
            .await
    }

    /// Delete an alert rule by UID.
    pub async fn delete_rule(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/v1/provisioning/alert-rules/{}", uid))
            .await
    }

    /// List all rule groups in a folder.
    pub async fn list_rule_groups(&self, folder_uid: &str) -> GrafanaResult<Vec<AlertRuleGroup>> {
        // The Grafana API returns rule groups under the ruler path
        let resp: serde_json::Value = self
            .client
            .api_get(&format!("/ruler/grafana/api/v1/rules/{}", folder_uid))
            .await?;
        // Parse the response which is an array of rule groups
        serde_json::from_value(resp).map_err(|e| GrafanaError::parse_error(e.to_string()))
    }

    /// Get a specific rule group.
    pub async fn get_rule_group(
        &self,
        folder_uid: &str,
        group_name: &str,
    ) -> GrafanaResult<AlertRuleGroup> {
        self.client
            .api_get(&format!(
                "/ruler/grafana/api/v1/rules/{}/{}",
                folder_uid, group_name
            ))
            .await
    }

    /// Set the evaluation interval for a rule group.
    pub async fn set_rule_group_interval(
        &self,
        folder_uid: &str,
        group_name: &str,
        interval_secs: i64,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({
            "name": group_name,
            "interval": interval_secs,
            "rules": []
        });
        self.client
            .api_post(
                &format!("/ruler/grafana/api/v1/rules/{}", folder_uid),
                &body,
            )
            .await
    }

    /// List all contact points.
    pub async fn list_contact_points(&self) -> GrafanaResult<Vec<ContactPoint>> {
        self.client
            .api_get("/v1/provisioning/contact-points")
            .await
    }

    /// Create a new contact point.
    pub async fn create_contact_point(&self, cp: ContactPoint) -> GrafanaResult<ContactPoint> {
        self.client
            .api_post("/v1/provisioning/contact-points", &cp)
            .await
    }

    /// Update a contact point by UID.
    pub async fn update_contact_point(&self, uid: &str, cp: ContactPoint) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put(&format!("/v1/provisioning/contact-points/{}", uid), &cp)
            .await
    }

    /// Delete a contact point by UID.
    pub async fn delete_contact_point(&self, uid: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/v1/provisioning/contact-points/{}", uid))
            .await
    }

    /// Get the notification policy tree.
    pub async fn get_notification_policy(&self) -> GrafanaResult<NotificationPolicy> {
        self.client
            .api_get("/v1/provisioning/policies")
            .await
    }

    /// Set the notification policy tree.
    pub async fn set_notification_policy(&self, policy: NotificationPolicy) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_put("/v1/provisioning/policies", &policy)
            .await
    }

    /// List all mute timings.
    pub async fn list_mute_timings(&self) -> GrafanaResult<Vec<MuteTimeInterval>> {
        self.client
            .api_get("/v1/provisioning/mute-timings")
            .await
    }

    /// Create a mute timing.
    pub async fn create_mute_timing(&self, mute: MuteTimeInterval) -> GrafanaResult<MuteTimeInterval> {
        self.client
            .api_post("/v1/provisioning/mute-timings", &mute)
            .await
    }

    /// Update a mute timing by name.
    pub async fn update_mute_timing(
        &self,
        name: &str,
        mute: MuteTimeInterval,
    ) -> GrafanaResult<MuteTimeInterval> {
        self.client
            .api_put(&format!("/v1/provisioning/mute-timings/{}", name), &mute)
            .await
    }

    /// Delete a mute timing by name.
    pub async fn delete_mute_timing(&self, name: &str) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_delete(&format!("/v1/provisioning/mute-timings/{}", name))
            .await
    }

    /// List currently firing alert instances.
    pub async fn list_alert_instances(&self) -> GrafanaResult<Vec<AlertInstance>> {
        #[derive(serde::Deserialize)]
        struct AlertsResp {
            #[serde(default)]
            alerts: Vec<AlertInstance>,
        }
        let resp: AlertsResp = self
            .client
            .api_get("/alertmanager/grafana/api/v2/alerts")
            .await?;
        Ok(resp.alerts)
    }

    /// Get alert state history for a rule.
    pub async fn get_state_history(&self, rule_uid: &str) -> GrafanaResult<AlertStateHistory> {
        let params = [("ruleUID", rule_uid)];
        self.client
            .api_get_with_query("/v1/rules/history", &params)
            .await
    }

    /// Test notification receivers with a custom payload.
    pub async fn test_receivers(&self, receivers: serde_json::Value) -> GrafanaResult<serde_json::Value> {
        self.client
            .api_post("/alertmanager/grafana/config/api/v1/receivers/test", &receivers)
            .await
    }
}
