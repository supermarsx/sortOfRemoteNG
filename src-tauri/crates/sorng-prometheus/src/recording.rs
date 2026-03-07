// ── Prometheus recording rule management ─────────────────────────────────────

use crate::client::PrometheusClient;
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;

pub struct RecordingManager;

impl RecordingManager {
    pub async fn list_recording_rules(client: &PrometheusClient) -> PrometheusResult<Vec<RecordingRule>> {
        let body = client.api_get("/api/v1/rules?type=record").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("recording rules: {e}")))?;
        let groups = v["data"]["groups"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing groups"))?;
        let mut rules = Vec::new();
        for g in groups {
            if let Some(rs) = g["rules"].as_array() {
                for r in rs {
                    if r["type"].as_str() == Some("recording") {
                        rules.push(serde_json::from_value(r.clone())
                            .map_err(|e| PrometheusError::parse(format!("recording rule parse: {e}")))?);
                    }
                }
            }
        }
        Ok(rules)
    }

    pub async fn get_recording_rule(client: &PrometheusClient, group: &str, name: &str) -> PrometheusResult<RecordingRule> {
        let rules = Self::list_recording_rules(client).await?;
        rules.into_iter()
            .find(|r| r.group == group && r.name == name)
            .ok_or_else(|| PrometheusError::rule_not_found(format!("{group}/{name}")))
    }

    pub async fn create_recording_rule(client: &PrometheusClient, req: &CreateRecordingRuleRequest) -> PrometheusResult<RecordingRule> {
        let config = client.read_remote_file(client.config_path()).await?;
        let rule_yaml = format_recording_rule_yaml(req);
        let new_config = insert_rule_into_group(&config, &req.group, &rule_yaml);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Self::get_recording_rule(client, &req.group, &req.name).await
    }

    pub async fn update_recording_rule(client: &PrometheusClient, req: &UpdateRecordingRuleRequest) -> PrometheusResult<RecordingRule> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = update_recording_rule_in_config(&config, &req.group, &req.name, req);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Self::get_recording_rule(client, &req.group, &req.name).await
    }

    pub async fn delete_recording_rule(client: &PrometheusClient, group: &str, name: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_rule_from_config(&config, group, name);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn list_rule_groups(client: &PrometheusClient) -> PrometheusResult<Vec<RuleGroup>> {
        let body = client.api_get("/api/v1/rules").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("rule groups: {e}")))?;
        let groups = v["data"]["groups"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing groups"))?;
        let mut result = Vec::new();
        for g in groups {
            result.push(serde_json::from_value(g.clone())
                .map_err(|e| PrometheusError::parse(format!("group parse: {e}")))?);
        }
        Ok(result)
    }

    pub async fn get_rule_group(client: &PrometheusClient, name: &str) -> PrometheusResult<RuleGroup> {
        let groups = Self::list_rule_groups(client).await?;
        groups.into_iter()
            .find(|g| g.name == name)
            .ok_or_else(|| PrometheusError::rule_not_found(format!("group: {name}")))
    }

    pub async fn create_rule_group(client: &PrometheusClient, req: &CreateRuleGroupRequest) -> PrometheusResult<RuleGroup> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = add_rule_group_to_config(&config, req);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Self::get_rule_group(client, &req.name).await
    }

    pub async fn delete_rule_group(client: &PrometheusClient, name: &str) -> PrometheusResult<()> {
        let config = client.read_remote_file(client.config_path()).await?;
        let new_config = remove_rule_group_from_config(&config, name);
        client.write_remote_file(client.config_path(), &new_config).await?;
        client.api_post("/-/reload", "").await?;
        Ok(())
    }

    pub async fn get_rule_evaluation_stats(client: &PrometheusClient) -> PrometheusResult<Vec<RuleEvalStats>> {
        let body = client.api_get("/api/v1/rules").await?;
        let v: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| PrometheusError::parse(format!("rule stats: {e}")))?;
        let groups = v["data"]["groups"].as_array()
            .ok_or_else(|| PrometheusError::parse("missing groups"))?;
        let mut stats = Vec::new();
        for g in groups {
            let group_name = g["name"].as_str().unwrap_or("").to_string();
            if let Some(rs) = g["rules"].as_array() {
                for r in rs {
                    stats.push(RuleEvalStats {
                        group_name: group_name.clone(),
                        rule_name: r["name"].as_str().unwrap_or("").to_string(),
                        rule_type: r["type"].as_str().unwrap_or("").to_string(),
                        evaluations_total: r["evaluationTime"].as_u64().unwrap_or(0),
                        evaluation_failures_total: 0,
                        last_duration_seconds: r["lastEvaluation"].as_f64().unwrap_or(0.0),
                        average_duration_seconds: 0.0,
                    });
                }
            }
        }
        Ok(stats)
    }

    pub async fn check_rules_syntax(client: &PrometheusClient, rules_yaml: &str) -> PrometheusResult<bool> {
        // Write to temp file and use promtool check rules
        let tmp = "/tmp/prom_rules_check.yml";
        client.write_remote_file(tmp, rules_yaml).await?;
        let out = client.exec_ssh(&format!("promtool check rules {tmp}")).await?;
        let _ = client.exec_ssh(&format!("rm -f {tmp}")).await;
        Ok(out.exit_code == 0)
    }
}

// ── Config helpers (stub) ────────────────────────────────────────────────────

fn format_recording_rule_yaml(_req: &CreateRecordingRuleRequest) -> String {
    String::new()
}

fn insert_rule_into_group(config: &str, _group: &str, _rule_yaml: &str) -> String {
    config.to_string()
}

fn update_recording_rule_in_config(config: &str, _group: &str, _name: &str, _req: &UpdateRecordingRuleRequest) -> String {
    config.to_string()
}

fn remove_rule_from_config(config: &str, _group: &str, _name: &str) -> String {
    config.to_string()
}

fn add_rule_group_to_config(config: &str, _req: &CreateRuleGroupRequest) -> String {
    config.to_string()
}

fn remove_rule_group_from_config(config: &str, _name: &str) -> String {
    config.to_string()
}
