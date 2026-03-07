// ── Prometheus alert management ──────────────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct AlertManager;

impl AlertManager {
    pub async fn list_alert_rules(client: &PrometheusClient) -> PrometheusResult<Vec<AlertRule>> {
        let body = client.api_get("/api/v1/rules?type=alert").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("alert rules: {e}")))?;
        let groups = v["data"]["groups"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing groups"))?;
        let mut rules = Vec::new();
        for g in groups {
            if let Some(rs) = g["rules"].as_array() {
                for r in rs {
                    if r["type"].as_str() == Some("alerting") {
                        rules.push(serde_json::from_value(r.clone())
                            .map_err(|e| PrometheusError::parse(format!("alert rule parse: {e}")))?);
                    }
                }
            }
        }
        Ok(rules)
    }

    pub async fn get_alert_rule(client: &PrometheusClient, group: &str, name: &str) -> PrometheusResult<AlertRule> {
        let rules = Self::list_alert_rules(client).await?;
        rules.into_iter()
            .find(|r| r.group == group && r.name == name)
            .ok_or_else(|| PrometheusError::alert_not_found(format!("{group}/{name}")))
    }

    pub async fn create_alert_rule(client: &PrometheusClient, req: &CreateAlertRuleRequest) -> PrometheusResult<AlertRule> {
        let config = client.read_remote_file(client.config_path()).await?;
        let rule_yaml = format_alert_rule_yaml(req);
        let new_config = insert_rule_into_group(&config, &req.group, &rule_yaml);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Self::get_alert_rule(client, &req.group, &req.name).await
    }

    pub async fn update_alert_rule(client: &PrometheusClient, req: &UpdateAlertRuleRequest) -> PrometheusResult<AlertRule> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = update_rule_in_config(&config, &req.group, &req.name, req);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Self::get_alert_rule(client, &req.group, &req.name).await
    }

    pub async fn delete_alert_rule(client: &PrometheusClient, group: &str, name: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_rule_from_config(&config, group, name);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn list_active_alerts(client: &PrometheusClient) -> PrometheusResult<Vec<ActiveAlert>> {
        let body = client.api_get("/api/v1/alerts").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("active alerts: {e}")))?;
        let alerts = v["data"]["alerts"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing alerts"))?;
        let mut result = Vec::new();
        for a in alerts {
            result.push(serde_json::from_value(a.clone())
                .map_err(|e| PrometheusError::parse(format!("alert parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn get_alert_status(client: &PrometheusClient, alert_name: &str) -> PrometheusResult<Vec<ActiveAlert>> {
        let alerts = Self::list_active_alerts(client).await?;
        Ok(alerts.into_iter().filter(|a| a.name == alert_name).collect())
    }

    pub async fn list_alert_groups(client: &PrometheusClient) -> PrometheusResult<Vec<AlertGroup>> {
        let body = client.api_get("/api/v1/rules?type=alert").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("alert groups: {e}")))?;
        let groups = v["data"]["groups"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing groups"))?;
        let mut result = Vec::new();
        for g in groups {
            result.push(serde_json::from_value(g.clone())
                .map_err(|e| PrometheusError::parse(format!("group parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn silences_list(client: &PrometheusClient) -> PrometheusResult<Vec<Silence>> {
        let body = client.api_get("/api/v1/silences").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("silences: {e}")))?;
        let data = v["data"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing data"))?;
        let mut result = Vec::new();
        for s in data {
            result.push(serde_json::from_value(s.clone())
                .map_err(|e| PrometheusError::parse(format!("silence parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn create_silence(client: &PrometheusClient, req: &CreateSilenceRequest) -> PrometheusResult<Silence> {
        let body = serde_json::to_string(req)
            .map_err(|e| PrometheusError::parse(format!("serialize silence: {e}")))?;
        let resp = client.api_post_json("/api/v1/silences", &body).await?;
        let v: serde_json::Value = serde_json::from_str(&resp)
            .map_err(|e| PrometheusError::parse(format!("silence response: {e}")))?;
        serde_json::from_value(v["data"].clone())
            .map_err(|e| PrometheusError::parse(format!("silence parse: {e}")))
    }

    pub async fn delete_silence(client: &PrometheusClient, silence_id: &str) -> PrometheusResult<()> {
        client.api_delete(&format!("/api/v1/silence/{silence_id}")).await?;
        Ok(())
    }

    pub async fn get_alertmanager_status(client: &PrometheusClient) -> PrometheusResult<AlertmanagerStatus> {
        let body = client.api_get("/api/v1/alertmanagers").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("alertmanager status: {e}")))?;
        serde_json::from_value(v["data"].clone())
            .map_err(|e| PrometheusError::parse(format!("alertmanager parse: {e}")))
    }

    pub async fn get_alertmanager_config(client: &PrometheusClient) -> PrometheusResult<String> {
        let out = client.exec_ssh("cat /etc/alertmanager/alertmanager.yml").await?;
        Ok(out.stdout)
    }

    pub async fn update_alertmanager_config(client: &PrometheusClient, req: &UpdateAlertmanagerConfigRequest) -> PrometheusResult<()> {
        client.write_remote_file("/etc/alertmanager/alertmanager.yml", &req.config_yaml).await?;
        client.exec_ssh("sudo systemctl reload alertmanager").await?;
        Ok(())
    }

    pub async fn list_alert_receivers(client: &PrometheusClient) -> PrometheusResult<Vec<AlertReceiver>> {
        let body = client.api_get("/api/v1/status/config").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("receivers: {e}")))?;
        // Parse receivers from config YAML
        let _yaml = v["data"]["yaml"].as_str().unwrap_or("");
        // Stub: real implementation would parse YAML for receivers
        Ok(Vec::new())
    }

    pub async fn test_alert_receiver(client: &PrometheusClient, req: &TestAlertReceiverRequest) -> PrometheusResult<bool> {
        let body = serde_json::to_string(req)
            .map_err(|e| PrometheusError::parse(format!("serialize test: {e}")))?;
        let _resp = client.api_post_json("/api/v1/alerts", &body).await?;
        Ok(true)
    }

    pub async fn list_alert_inhibitions(client: &PrometheusClient) -> PrometheusResult<Vec<AlertInhibition>> {
        let config_str = Self::get_alertmanager_config(client).await?;
        // Stub: parse inhibit_rules from config
        let _ = config_str;
        Ok(Vec::new())
    }
}

// ── Config helpers (stub) ────────────────────────────────────────────────────

fn format_alert_rule_yaml(_req: &CreateAlertRuleRequest) -> String {
    String::new()
}

fn insert_rule_into_group(config: &str, _group: &str, _rule_yaml: &str) -> String {
    config.to_string()
}

fn update_rule_in_config(config: &str, _group: &str, _name: &str, _req: &UpdateAlertRuleRequest) -> String {
    config.to_string()
}

fn remove_rule_from_config(config: &str, _group: &str, _name: &str) -> String {
    config.to_string()
}
