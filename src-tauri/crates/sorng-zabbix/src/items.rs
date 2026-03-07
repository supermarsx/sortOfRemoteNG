// ── sorng-zabbix/src/items.rs ────────────────────────────────────────────────
//! Item management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct ItemManager;

/// Zabbix item types.
pub enum ItemType {
    ZabbixAgent = 0,
    ZabbixTrapper = 2,
    SimpleCheck = 3,
    ZabbixInternal = 5,
    ZabbixAgentActive = 7,
    HttpAgent = 19,
}

/// Zabbix item value types.
pub enum ValueType {
    Float = 0,
    Character = 1,
    Log = 2,
    Unsigned = 3,
    Text = 4,
}

impl ItemManager {
    /// Retrieve items.  method: item.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixItem>, ZabbixError> {
        client.request_typed("item.get", params).await
    }

    /// Create an item.  method: item.create
    pub async fn create(
        client: &ZabbixClient,
        item: &ZabbixItem,
    ) -> Result<Value, ZabbixError> {
        client.request("item.create", item).await
    }

    /// Update an item.  method: item.update
    pub async fn update(
        client: &ZabbixClient,
        item: &ZabbixItem,
    ) -> Result<Value, ZabbixError> {
        client.request("item.update", item).await
    }

    /// Delete items by IDs.  method: item.delete
    pub async fn delete(
        client: &ZabbixClient,
        itemids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("item.delete", itemids).await
    }
}
