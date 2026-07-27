// ── rspamd configuration management ──────────────────────────────────────────

use crate::actions::ActionManager;
use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct RspamdConfigManager;

impl RspamdConfigManager {
    /// GET /actions — get all configured actions
    pub async fn get_actions(client: &RspamdClient) -> RspamdResult<Vec<RspamdAction>> {
        debug!("RSPAMD config get_actions");
        ActionManager::list(client).await
    }

    /// GET /plugins — list all configured plugins
    pub async fn get_plugins(client: &RspamdClient) -> RspamdResult<Vec<RspamdPlugin>> {
        debug!("RSPAMD config get_plugins");
        let raw: serde_json::Value = client.get("/plugins").await?;
        Self::parse_plugins(&raw)
    }

    /// Standard controller API does not support changing plugin enablement.
    pub async fn enable_plugin(_client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD enable_plugin: {name}");
        Err(RspamdError::api(format!(
            "Rspamd's controller API cannot enable plugin '{name}'; update the server configuration and restart or reload Rspamd"
        )))
    }

    /// Standard controller API does not support changing plugin enablement.
    pub async fn disable_plugin(_client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD disable_plugin: {name}");
        Err(RspamdError::api(format!(
            "Rspamd's controller API cannot disable plugin '{name}'; update the server configuration and restart or reload Rspamd"
        )))
    }

    /// Standard controller API does not expose a reload operation.
    pub async fn reload(_client: &RspamdClient) -> RspamdResult<()> {
        debug!("RSPAMD reload_config");
        Err(RspamdError::api(
            "Rspamd's controller API does not expose a configuration reload endpoint",
        ))
    }

    /// POST /saveactions — save a complete set of actions
    pub async fn save_actions(client: &RspamdClient, actions: &[RspamdAction]) -> RspamdResult<()> {
        debug!("RSPAMD save_actions");
        ActionManager::save(client, actions).await
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_plugins(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdPlugin>> {
        let mut plugins = Vec::new();
        if let Some(arr) = raw.as_array() {
            for item in arr {
                let name = item
                    .get("name")
                    .and_then(|value| value.as_str())
                    .filter(|name| !name.trim().is_empty())
                    .ok_or_else(|| RspamdError::parse("Rspamd plugin entry is missing its name"))?;
                plugins.push(RspamdPlugin {
                    name: name.to_string(),
                    enabled: item
                        .get("enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true),
                    description: item
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                });
            }
        } else if let Some(obj) = raw.as_object() {
            for (name, info) in obj {
                if name.trim().is_empty() {
                    return Err(RspamdError::parse("Rspamd plugin entry has an empty name"));
                }
                plugins.push(RspamdPlugin {
                    name: name.clone(),
                    enabled: info
                        .get("enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true),
                    description: info
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                });
            }
        } else {
            return Err(RspamdError::parse(
                "Rspamd /plugins response must be an array or object",
            ));
        }
        Ok(plugins)
    }
}
