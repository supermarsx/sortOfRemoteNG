// ── sorng-grafana/src/alerts.rs ──────────────────────────────────────────────
//! Alert rule and notification management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct AlertManager;

impl AlertManager {
    /// List alert rules.  GET /api/ruler/grafana/api/v1/rules/:folderUid
    /// If folder_uid is None returns all rules, if rule_group is also provided
    /// narrows to that group.
    pub async fn list_rules(
        client: &GrafanaClient,
        folder_uid: Option<&str>,
        rule_group: Option<&str>,
    ) -> GrafanaResult<Vec<AlertRule>> {
        let path = match (folder_uid, rule_group) {
            (Some(f), Some(g)) => {
                format!("ruler/grafana/api/v1/rules/{f}/{g}")
            }
            (Some(f), None) => {
                format!("ruler/grafana/api/v1/rules/{f}")
            }
            _ => "ruler/grafana/api/v1/rules".to_string(),
        };
        // The ruler API returns a map of folder -> groups -> rules.
        // Flatten into a Vec<AlertRule>.
        let raw: serde_json::Value = client.api_get(&path).await?;
        let mut rules = Vec::new();
        if let Some(obj) = raw.as_object() {
            for (_folder, groups) in obj {
                if let Some(arr) = groups.as_array() {
                    for group in arr {
                        if let Some(r) = group.get("rules").and_then(|v| v.as_array()) {
                            for rule_val in r {
                                if let Ok(rule) =
                                    serde_json::from_value::<AlertRule>(rule_val.clone())
                                {
                                    rules.push(rule);
                                }
                            }
                        }
                    }
                }
            }
        } else if let Some(arr) = raw.as_array() {
            // Single group response
            for group in arr {
                if let Some(r) = group.get("rules").and_then(|v| v.as_array()) {
                    for rule_val in r {
                        if let Ok(rule) =
                            serde_json::from_value::<AlertRule>(rule_val.clone())
                        {
                            rules.push(rule);
                        }
                    }
                }
            }
        }
        Ok(rules)
    }

    /// Get a single alert rule.  GET /api/v1/provisioning/alert-rules/:uid
    pub async fn get_rule(
        client: &GrafanaClient,
        uid: &str,
    ) -> GrafanaResult<AlertRule> {
        client
            .api_get(&format!("v1/provisioning/alert-rules/{uid}"))
            .await
    }

    /// Create an alert rule.  POST /api/v1/provisioning/alert-rules
    pub async fn create_rule(
        client: &GrafanaClient,
        rule: &AlertRule,
    ) -> GrafanaResult<AlertRule> {
        client
            .api_post("v1/provisioning/alert-rules", rule)
            .await
    }

    /// Update an alert rule.  PUT /api/v1/provisioning/alert-rules/:uid
    pub async fn update_rule(
        client: &GrafanaClient,
        uid: &str,
        rule: &AlertRule,
    ) -> GrafanaResult<AlertRule> {
        client
            .api_put(&format!("v1/provisioning/alert-rules/{uid}"), rule)
            .await
    }

    /// Delete an alert rule.  DELETE /api/v1/provisioning/alert-rules/:uid
    pub async fn delete_rule(
        client: &GrafanaClient,
        uid: &str,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_delete(&format!("v1/provisioning/alert-rules/{uid}"))
            .await
    }

    /// Pause or unpause an alert rule.  POST /api/v1/provisioning/alert-rules/:uid
    pub async fn pause_rule(
        client: &GrafanaClient,
        uid: &str,
        paused: bool,
    ) -> GrafanaResult<AlertRule> {
        // Fetch current rule, toggle isPaused, PUT back.
        let mut rule = Self::get_rule(client, uid).await?;
        rule.is_paused = Some(paused);
        Self::update_rule(client, uid, &rule).await
    }

    /// List legacy alert notification channels.  GET /api/alert-notifications
    pub async fn list_notifications(
        client: &GrafanaClient,
    ) -> GrafanaResult<Vec<AlertNotification>> {
        client.api_get("alert-notifications").await
    }

    /// Get a notification channel by ID.  GET /api/alert-notifications/:id
    pub async fn get_notification(
        client: &GrafanaClient,
        id: u64,
    ) -> GrafanaResult<AlertNotification> {
        client
            .api_get(&format!("alert-notifications/{id}"))
            .await
    }

    /// Create a notification channel.  POST /api/alert-notifications
    pub async fn create_notification(
        client: &GrafanaClient,
        config: &AlertNotification,
    ) -> GrafanaResult<AlertNotification> {
        client.api_post("alert-notifications", config).await
    }

    /// Update a notification channel.  PUT /api/alert-notifications/:id
    pub async fn update_notification(
        client: &GrafanaClient,
        id: u64,
        config: &AlertNotification,
    ) -> GrafanaResult<AlertNotification> {
        client
            .api_put(&format!("alert-notifications/{id}"), config)
            .await
    }

    /// Delete a notification channel.  DELETE /api/alert-notifications/:id
    pub async fn delete_notification(
        client: &GrafanaClient,
        id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        client
            .api_delete(&format!("alert-notifications/{id}"))
            .await
    }

    /// Test a notification channel.  POST /api/alert-notifications/test
    pub async fn test_notification(
        client: &GrafanaClient,
        id: u64,
    ) -> GrafanaResult<serde_json::Value> {
        let body = serde_json::json!({ "id": id });
        client
            .api_post("alert-notifications/test", &body)
            .await
    }
}
