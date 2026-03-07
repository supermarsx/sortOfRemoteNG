use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ApiResponse<T> {
    #[allow(dead_code)]
    status: String,
    data: T,
}

#[derive(Debug, Deserialize)]
struct RulesData {
    groups: Vec<RuleGroup>,
}

pub struct RuleManager<'a> {
    client: &'a PrometheusClient,
}

impl<'a> RuleManager<'a> {
    pub fn new(client: &'a PrometheusClient) -> Self {
        Self { client }
    }

    pub async fn list_rule_groups(&self) -> PrometheusResult<Vec<RuleGroup>> {
        let resp: ApiResponse<RulesData> = self.client.api_get("rules").await?;
        Ok(resp.data.groups)
    }

    pub async fn get_rule_group(&self, name: &str) -> PrometheusResult<RuleGroup> {
        let groups = self.list_rule_groups().await?;
        groups
            .into_iter()
            .find(|g| g.name == name)
            .ok_or_else(|| PrometheusError::rule_not_found(format!("Rule group '{}' not found", name)))
    }

    pub async fn list_alert_rules(&self) -> PrometheusResult<Vec<AlertRule>> {
        let resp: ApiResponse<RulesData> = self.client.api_get("rules?type=alert").await?;
        let mut alerts = Vec::new();
        for group in resp.data.groups {
            for rule_value in group.rules {
                if let Ok(alert) = serde_json::from_value::<AlertRule>(rule_value) {
                    alerts.push(alert);
                }
            }
        }
        Ok(alerts)
    }

    pub async fn list_recording_rules(&self) -> PrometheusResult<Vec<RecordingRule>> {
        let resp: ApiResponse<RulesData> = self.client.api_get("rules?type=record").await?;
        let mut recordings = Vec::new();
        for group in resp.data.groups {
            for rule_value in group.rules {
                if let Ok(rec) = serde_json::from_value::<RecordingRule>(rule_value) {
                    recordings.push(rec);
                }
            }
        }
        Ok(recordings)
    }

    pub async fn create_alert_rule(
        &self,
        req: &CreateAlertRuleRequest,
    ) -> PrometheusResult<serde_json::Value> {
        let body = serde_json::to_value(req)?;
        let result: serde_json::Value = self.client.api_post("rules/alert", &body).await?;
        Ok(result)
    }

    pub async fn update_alert_rule(
        &self,
        group: &str,
        name: &str,
        req: &CreateAlertRuleRequest,
    ) -> PrometheusResult<serde_json::Value> {
        let body = serde_json::to_value(req)?;
        let path = format!("rules/alert/{}/{}", group, name);
        let result: serde_json::Value = self.client.api_put(&path, &body).await?;
        Ok(result)
    }

    pub async fn delete_alert_rule(&self, group: &str, name: &str) -> PrometheusResult<()> {
        let path = format!("rules/alert/{}/{}", group, name);
        self.client.api_delete(&path).await
    }

    pub async fn create_recording_rule(
        &self,
        req: &CreateRecordingRuleRequest,
    ) -> PrometheusResult<serde_json::Value> {
        let body = serde_json::to_value(req)?;
        let result: serde_json::Value = self.client.api_post("rules/record", &body).await?;
        Ok(result)
    }

    pub async fn update_recording_rule(
        &self,
        group: &str,
        name: &str,
        req: &CreateRecordingRuleRequest,
    ) -> PrometheusResult<serde_json::Value> {
        let body = serde_json::to_value(req)?;
        let path = format!("rules/record/{}/{}", group, name);
        let result: serde_json::Value = self.client.api_put(&path, &body).await?;
        Ok(result)
    }

    pub async fn delete_recording_rule(&self, group: &str, name: &str) -> PrometheusResult<()> {
        let path = format!("rules/record/{}/{}", group, name);
        self.client.api_delete(&path).await
    }

    pub async fn reload_rules(&self) -> PrometheusResult<()> {
        self.client.api_post_empty("-/reload").await
    }
}
