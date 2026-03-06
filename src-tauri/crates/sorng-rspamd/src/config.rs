// ── rspamd configuration management ──────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::RspamdResult;
use crate::types::*;
use log::debug;

pub struct RspamdConfigManager;

impl RspamdConfigManager {
    /// GET /actions — get all configured actions
    pub async fn get_actions(client: &RspamdClient) -> RspamdResult<Vec<RspamdAction>> {
        debug!("RSPAMD config get_actions");
        let raw: serde_json::Value = client.get("/actions").await?;
        Self::parse_actions(&raw)
    }

    /// GET /plugins — list all configured plugins
    pub async fn get_plugins(client: &RspamdClient) -> RspamdResult<Vec<RspamdPlugin>> {
        debug!("RSPAMD config get_plugins");
        let raw: serde_json::Value = client.get("/plugins").await?;
        Self::parse_plugins(&raw)
    }

    /// POST /plugins — enable a specific plugin
    pub async fn enable_plugin(client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD enable_plugin: {name}");
        let body = serde_json::json!({
            "name": name,
            "enabled": true,
        });
        let _: serde_json::Value = client.post("/plugins", &body).await?;
        Ok(())
    }

    /// POST /plugins — disable a specific plugin
    pub async fn disable_plugin(client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD disable_plugin: {name}");
        let body = serde_json::json!({
            "name": name,
            "enabled": false,
        });
        let _: serde_json::Value = client.post("/plugins", &body).await?;
        Ok(())
    }

    /// POST /reload — reload rspamd configuration
    pub async fn reload(client: &RspamdClient) -> RspamdResult<()> {
        debug!("RSPAMD reload_config");
        client.post_no_body("/reload").await
    }

    /// POST /saveactions — save a complete set of actions
    pub async fn save_actions(client: &RspamdClient, actions: &[RspamdAction]) -> RspamdResult<()> {
        debug!("RSPAMD save_actions");
        let thresholds: Vec<serde_json::Value> = actions.iter()
            .filter(|a| a.enabled)
            .filter_map(|a| {
                a.threshold.map(|t| {
                    serde_json::json!({
                        "action": a.name,
                        "value": t,
                    })
                })
            })
            .collect();
        let _: serde_json::Value = client.post("/saveactions", &thresholds).await?;
        Ok(())
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_actions(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdAction>> {
        let mut actions = Vec::new();
        if let Some(arr) = raw.as_array() {
            for item in arr {
                let name = item.get("action")
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let threshold = item.get("value")
                    .or_else(|| item.get("threshold"))
                    .and_then(|v| v.as_f64());
                let enabled = item.get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                actions.push(RspamdAction { name, threshold, enabled });
            }
        } else if let Some(obj) = raw.as_object() {
            for (name, info) in obj {
                let threshold = if info.is_number() {
                    info.as_f64()
                } else {
                    info.get("value")
                        .or_else(|| info.get("threshold"))
                        .and_then(|v| v.as_f64())
                };
                let enabled = info.get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                actions.push(RspamdAction { name: name.clone(), threshold, enabled });
            }
        }
        Ok(actions)
    }

    fn parse_plugins(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdPlugin>> {
        let mut plugins = Vec::new();
        if let Some(arr) = raw.as_array() {
            for item in arr {
                plugins.push(RspamdPlugin {
                    name: item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    enabled: item.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                    description: item.get("description").and_then(|v| v.as_str()).map(String::from),
                });
            }
        } else if let Some(obj) = raw.as_object() {
            for (name, info) in obj {
                plugins.push(RspamdPlugin {
                    name: name.clone(),
                    enabled: info.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                    description: info.get("description").and_then(|v| v.as_str()).map(String::from),
                });
            }
        }
        Ok(plugins)
    }
}
