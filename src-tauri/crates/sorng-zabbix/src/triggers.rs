// ── sorng-zabbix/src/triggers.rs ─────────────────────────────────────────────
//! Trigger management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct TriggerManager;

/// Zabbix trigger priority levels.
pub enum TriggerPriority {
    NotClassified = 0,
    Information = 1,
    Warning = 2,
    Average = 3,
    High = 4,
    Disaster = 5,
}

impl TriggerManager {
    /// Retrieve triggers.  method: trigger.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixTrigger>, ZabbixError> {
        client.request_typed("trigger.get", params).await
    }

    /// Create a trigger.  method: trigger.create
    pub async fn create(
        client: &ZabbixClient,
        trigger: &ZabbixTrigger,
    ) -> Result<Value, ZabbixError> {
        client.request("trigger.create", trigger).await
    }

    /// Update a trigger.  method: trigger.update
    pub async fn update(
        client: &ZabbixClient,
        trigger: &ZabbixTrigger,
    ) -> Result<Value, ZabbixError> {
        client.request("trigger.update", trigger).await
    }

    /// Delete triggers by IDs.  method: trigger.delete
    pub async fn delete(
        client: &ZabbixClient,
        triggerids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("trigger.delete", triggerids).await
    }
}
