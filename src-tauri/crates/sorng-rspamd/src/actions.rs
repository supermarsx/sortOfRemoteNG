// ── rspamd action management ─────────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct ActionManager;

impl ActionManager {
    /// GET /actions — list all actions with their thresholds
    pub async fn list(client: &RspamdClient) -> RspamdResult<Vec<RspamdAction>> {
        debug!("RSPAMD list_actions");
        let raw: serde_json::Value = client.get("/actions").await?;
        Self::parse_actions(&raw)
    }

    /// Get a specific action by name
    pub async fn get(client: &RspamdClient, name: &str) -> RspamdResult<RspamdAction> {
        debug!("RSPAMD get_action: {name}");
        let actions = Self::list(client).await?;
        actions.into_iter()
            .find(|a| a.name == name)
            .ok_or_else(|| RspamdError::not_found(format!("Action not found: {name}")))
    }

    /// POST /saveactions — set threshold for a specific action
    pub async fn set(client: &RspamdClient, name: &str, threshold: f64) -> RspamdResult<()> {
        debug!("RSPAMD set_action: {name} = {threshold}");
        // Get current actions, update the target, and save all
        let mut actions = Self::list(client).await?;
        let found = actions.iter_mut().find(|a| a.name == name);
        match found {
            Some(action) => {
                action.threshold = Some(threshold);
            }
            None => {
                return Err(RspamdError::not_found(format!("Action not found: {name}")));
            }
        }
        // Build the thresholds array in rspamd format
        let thresholds: Vec<serde_json::Value> = actions.iter()
            .filter_map(|a| {
                a.threshold.map(|t| {
                    serde_json::json!({
                        "action": a.name,
                        "value": t
                    })
                })
            })
            .collect();
        let _: serde_json::Value = client.post("/saveactions", &thresholds).await?;
        Ok(())
    }

    /// Enable a specific action
    pub async fn enable(client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD enable_action: {name}");
        let mut actions = Self::list(client).await?;
        let found = actions.iter_mut().find(|a| a.name == name);
        match found {
            Some(action) => {
                action.enabled = true;
            }
            None => {
                return Err(RspamdError::not_found(format!("Action not found: {name}")));
            }
        }
        let thresholds: Vec<serde_json::Value> = actions.iter()
            .filter(|a| a.enabled)
            .filter_map(|a| {
                a.threshold.map(|t| {
                    serde_json::json!({
                        "action": a.name,
                        "value": t
                    })
                })
            })
            .collect();
        let _: serde_json::Value = client.post("/saveactions", &thresholds).await?;
        Ok(())
    }

    /// Disable a specific action
    pub async fn disable(client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD disable_action: {name}");
        let mut actions = Self::list(client).await?;
        let found = actions.iter_mut().find(|a| a.name == name);
        match found {
            Some(action) => {
                action.enabled = false;
            }
            None => {
                return Err(RspamdError::not_found(format!("Action not found: {name}")));
            }
        }
        let thresholds: Vec<serde_json::Value> = actions.iter()
            .filter(|a| a.enabled)
            .filter_map(|a| {
                a.threshold.map(|t| {
                    serde_json::json!({
                        "action": a.name,
                        "value": t
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
}
