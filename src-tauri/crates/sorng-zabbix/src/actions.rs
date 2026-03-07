// ── sorng-zabbix/src/actions.rs ──────────────────────────────────────────────
//! Action management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct ActionManager;

impl ActionManager {
    /// Retrieve actions.  method: action.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixAction>, ZabbixError> {
        client.request_typed("action.get", params).await
    }

    /// Create an action.  method: action.create
    pub async fn create(
        client: &ZabbixClient,
        action: &ZabbixAction,
    ) -> Result<Value, ZabbixError> {
        client.request("action.create", action).await
    }

    /// Update an action.  method: action.update
    pub async fn update(
        client: &ZabbixClient,
        action: &ZabbixAction,
    ) -> Result<Value, ZabbixError> {
        client.request("action.update", action).await
    }

    /// Delete actions by IDs.  method: action.delete
    pub async fn delete(
        client: &ZabbixClient,
        actionids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("action.delete", actionids).await
    }
}
