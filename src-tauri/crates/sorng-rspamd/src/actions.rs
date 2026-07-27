// ── rspamd action management ─────────────────────────────────────────────────

use crate::client::RspamdClient;
use crate::error::{RspamdError, RspamdResult};
use crate::types::*;
use log::debug;

pub struct ActionManager;

impl ActionManager {
    const EDITABLE_ACTIONS: [&'static str; 4] =
        ["reject", "rewrite subject", "add header", "greylist"];

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
        actions
            .into_iter()
            .find(|action| action.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| RspamdError::not_found(format!("Action not found: {name}")))
    }

    /// POST /saveactions — set threshold for a specific action
    pub async fn set(client: &RspamdClient, name: &str, threshold: f64) -> RspamdResult<()> {
        debug!("RSPAMD set_action: {name} = {threshold}");
        Self::ensure_editable(name)?;
        if !threshold.is_finite() {
            return Err(RspamdError::api(
                "Rspamd action threshold must be a finite number",
            ));
        }
        // Get current actions, update the target, and save all
        let mut actions = Self::list(client).await?;
        let found = actions
            .iter_mut()
            .find(|action| action.name.eq_ignore_ascii_case(name));
        match found {
            Some(action) => {
                action.threshold = Some(threshold);
                action.enabled = true;
            }
            None => {
                return Err(RspamdError::not_found(format!("Action not found: {name}")));
            }
        }
        Self::save(client, &actions).await
    }

    /// Enable a specific action
    pub async fn enable(client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD enable_action: {name}");
        Self::ensure_editable(name)?;
        let mut actions = Self::list(client).await?;
        let found = actions
            .iter_mut()
            .find(|action| action.name.eq_ignore_ascii_case(name));
        match found {
            Some(action) => {
                if action.threshold.is_none() {
                    return Err(RspamdError::api(format!(
                        "Action '{name}' has no threshold; set a threshold to enable it"
                    )));
                }
                action.enabled = true;
            }
            None => {
                return Err(RspamdError::not_found(format!("Action not found: {name}")));
            }
        }
        Self::save(client, &actions).await
    }

    /// Disable a specific action
    pub async fn disable(client: &RspamdClient, name: &str) -> RspamdResult<()> {
        debug!("RSPAMD disable_action: {name}");
        Self::ensure_editable(name)?;
        let mut actions = Self::list(client).await?;
        let found = actions
            .iter_mut()
            .find(|action| action.name.eq_ignore_ascii_case(name));
        match found {
            Some(action) => {
                action.enabled = false;
            }
            None => {
                return Err(RspamdError::not_found(format!("Action not found: {name}")));
            }
        }
        Self::save(client, &actions).await
    }

    /// POST /saveactions — save the four thresholds accepted by the controller.
    pub async fn save(client: &RspamdClient, actions: &[RspamdAction]) -> RspamdResult<()> {
        if let Some(action) = actions.iter().find(|action| {
            action.enabled && action.threshold.is_some_and(|value| !value.is_finite())
        }) {
            return Err(RspamdError::api(format!(
                "Rspamd action '{}' has a non-finite threshold",
                action.name
            )));
        }
        let thresholds: Vec<serde_json::Value> = Self::EDITABLE_ACTIONS
            .iter()
            .map(|name| {
                actions
                    .iter()
                    .find(|action| action.name.eq_ignore_ascii_case(name))
                    .filter(|action| action.enabled)
                    .and_then(|action| action.threshold)
                    .map_or(serde_json::Value::Null, serde_json::Value::from)
            })
            .collect();
        let _: serde_json::Value = client.post("/saveactions", &thresholds).await?;
        Ok(())
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn ensure_editable(name: &str) -> RspamdResult<()> {
        if Self::EDITABLE_ACTIONS
            .iter()
            .any(|editable| name.eq_ignore_ascii_case(editable))
        {
            Ok(())
        } else {
            Err(RspamdError::api(format!(
                "Rspamd /saveactions cannot modify action '{name}'"
            )))
        }
    }

    fn parse_actions(raw: &serde_json::Value) -> RspamdResult<Vec<RspamdAction>> {
        let mut actions = Vec::new();
        if let Some(arr) = raw.as_array() {
            for item in arr {
                let name = item
                    .get("action")
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str())
                    .filter(|name| !name.trim().is_empty())
                    .ok_or_else(|| RspamdError::parse("action entry is missing its name"))?
                    .to_string();
                let threshold_value = item
                    .get("value")
                    .or_else(|| item.get("threshold"))
                    .ok_or_else(|| {
                        RspamdError::parse(format!("action '{name}' is missing its threshold"))
                    })?;
                let threshold = if threshold_value.is_null() {
                    None
                } else {
                    Some(threshold_value.as_f64().ok_or_else(|| {
                        RspamdError::parse(format!(
                            "action '{name}' threshold must be numeric or null"
                        ))
                    })?)
                };
                let enabled = item
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(threshold.is_some());
                actions.push(RspamdAction {
                    name,
                    threshold,
                    enabled,
                });
            }
        } else if let Some(obj) = raw.as_object() {
            for (name, info) in obj {
                let threshold_value = if info.is_number() || info.is_null() {
                    info
                } else {
                    info.get("value")
                        .or_else(|| info.get("threshold"))
                        .ok_or_else(|| {
                            RspamdError::parse(format!("action '{name}' is missing its threshold"))
                        })?
                };
                let threshold = if threshold_value.is_null() {
                    None
                } else {
                    Some(threshold_value.as_f64().ok_or_else(|| {
                        RspamdError::parse(format!(
                            "action '{name}' threshold must be numeric or null"
                        ))
                    })?)
                };
                let enabled = info
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(threshold.is_some());
                actions.push(RspamdAction {
                    name: name.clone(),
                    threshold,
                    enabled,
                });
            }
        } else {
            return Err(RspamdError::parse(
                "Rspamd /actions response must be an array or object",
            ));
        }
        Ok(actions)
    }
}
